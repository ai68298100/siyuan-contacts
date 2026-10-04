import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "../e2e/kernel-safety.mjs";

const workspace = path.join(os.tmpdir(), `SiYuan-Contacts-AI-Spike-${randomUUID()}`);
const host = "127.0.0.1";
const kernel = [
    "D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe"),
].find((candidate) => fs.existsSync(candidate));
if (!kernel) throw new Error("未找到隔离测试内核");
const port = await new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once("error", rejectPort);
    server.listen({ host, port: 0 }, () => {
        const assigned = server.address().port;
        server.close((error) => error ? rejectPort(error) : resolvePort(assigned));
    });
});
await assertTestPortAvailable(host, port);
prepareIsolatedWorkspace(workspace, "ai-spike.json", "lvct ai preflight spike");
const child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", path.resolve(path.dirname(kernel), ".."), "--port", String(port)], {
    stdio: ["ignore", "ignore", "ignore"], windowsHide: true,
    env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
});
const assertRunning = observeTestKernel(child);
async function request(route, body = {}) {
    assertRunning();
    const response = await fetch(`http://${host}:${port}${route}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    assertRunning();
    return response.json();
}
const results = { isolated: true, uuidWorkspace: true, randomPort: true, configurationRead: false, externalServiceCalled: false };
try {
    const deadline = Date.now() + 60000;
    while (true) {
        assertRunning();
        const boot = await request("/api/system/bootProgress").catch(() => undefined);
        if (boot?.code === 0 && Number(boot.data?.progress) >= 100) break;
        if (Date.now() >= deadline) throw new Error("隔离内核启动超时");
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    results.version = (await request("/api/system/version")).data;
    const payload = await request("/api/ai/chatGPT", { msg: "虚构样本：样例甲与样例乙交流。只返回 JSON。" });
    results.unconfigured = {
        route: "/api/ai/chatGPT", requestKeys: ["msg"], code: payload.code,
        dataType: typeof payload.data, dataIsNull: payload.data === null,
        dataCharacters: typeof payload.data === "string" ? Array.from(payload.data).length : null,
        emptyReply: typeof payload.data === "string" && payload.data.trim() === "",
        configurationReply: typeof payload.data === "string" && /未配置|请先|密钥|API key|token|not configured|config.*AI|AI.*config/i.test(payload.data),
        message: typeof payload.msg === "string" && /AI|人工智能|未配置|密钥|key|token|config/i.test(payload.msg)
            ? "AI configuration required" : "unclassified (raw message omitted)",
    };
    results.unconfiguredVerified = payload.code !== 0 || results.unconfigured.emptyReply || results.unconfigured.configurationReply;
    results.successfulGeneration = "host_pending: requires explicitly configured isolated AI; no external service called";
    if (!results.unconfiguredVerified) throw new Error("未配置预期未核实，不记录为成功生成");
} catch (error) {
    results.failure = error instanceof Error && error.message === "隔离内核启动超时" ? "boot_timeout" : "spike_failed";
    process.exitCode = 1;
} finally {
    fs.writeFileSync(path.join(import.meta.dirname, "ai-preflight-results.json"), JSON.stringify(results, null, 2) + "\n");
    await request("/api/system/exit", { force: true }).catch(() => {});
    if (child.exitCode === null && child.signalCode === null) child.kill();
}
console.log(JSON.stringify(results, null, 2));
