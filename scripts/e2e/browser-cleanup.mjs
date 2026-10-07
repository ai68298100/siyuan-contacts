import { lstat, realpath, rm } from "node:fs/promises";
import { basename, dirname, resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

function hasExited(child) {
    return child.exitCode !== null && child.exitCode !== undefined
        || child.signalCode !== null && child.signalCode !== undefined;
}

function waitForExit(child, timeoutMs) {
    if (hasExited(child)) return Promise.resolve();
    return new Promise((resolveExit, rejectExit) => {
        const finish = (error) => {
            clearTimeout(timer);
            child.removeListener("exit", onExit);
            child.removeListener("error", onError);
            if (error) rejectExit(error);
            else resolveExit();
        };
        const onExit = () => finish();
        const onError = (error) => finish(error);
        const timer = setTimeout(() => finish(new Error("隔离浏览器进程未在清理时限内退出")), timeoutMs);
        child.once("exit", onExit);
        child.once("error", onError);
        // A short-lived helper (notably Windows taskkill) may exit between the
        // initial check above and listener registration. Re-check after the
        // listeners are attached so that this race cannot turn into a timeout.
        if (hasExited(child)) finish();
    });
}

export async function stopIsolatedBrowser(browser, {
    platform = process.platform,
    spawnProcess = spawn,
    timeoutMs = 15000,
    requestClose,
} = {}) {
    if (!browser || hasExited(browser)) return;
    if (!Number.isSafeInteger(browser.pid) || browser.pid <= 0) throw new Error("隔离浏览器 PID 无效，拒绝终止进程");
    if (requestClose) {
        const gracefullyStopped = waitForExit(browser, timeoutMs);
        try {
            Promise.resolve().then(requestClose).catch(() => {});
            await gracefullyStopped;
            return;
        } catch {
            if (hasExited(browser)) return;
        }
    }
    const stopped = waitForExit(browser, timeoutMs);
    if (platform === "win32") {
        let helper;
        try {
            helper = spawnProcess("taskkill", ["/pid", String(browser.pid), "/T", "/F"], {
                stdio: "ignore",
                windowsHide: true,
            });
            await Promise.all([stopped, waitForExit(helper, timeoutMs)]);
        } catch (error) {
            browser.kill();
            if (helper && !hasExited(helper)) helper.kill();
            try {
                await waitForExit(browser, timeoutMs);
                if (helper && !hasExited(helper)) await waitForExit(helper, timeoutMs);
            } catch (finalError) {
                throw new Error("隔离浏览器终止后仍未确认退出", { cause: new AggregateError([error, finalError]) });
            }
        }
    } else {
        browser.kill();
        await stopped;
    }
}

export async function removeIsolatedBrowserProfile(profile, temporaryRoot = tmpdir()) {
    const target = resolve(profile);
    if (dirname(target) !== resolve(temporaryRoot) || !/^lvct-(?:ui|shot)-[a-zA-Z0-9]+$/.test(basename(target))) {
        throw new Error("浏览器清理路径不属于本轮临时目录，拒绝递归删除");
    }
    let stat;
    try {
        stat = await lstat(target);
    } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("浏览器临时目录不是普通目录，拒绝递归删除");
    const actualRoot = await realpath(temporaryRoot);
    const actualTarget = await realpath(target);
    if (dirname(actualTarget) !== actualRoot || basename(actualTarget) !== basename(target)) {
        throw new Error("浏览器临时目录解析后越界，拒绝递归删除");
    }
    await rm(actualTarget, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
import { readFileSync } from "node:fs";

export function readBrowserDebuggingPort(profile) {
    try {
        const port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]);
        return Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : undefined;
    } catch (error) {
        if (["ENOENT", "EBUSY", "EPERM"].includes(error.code)) return undefined;
        throw error;
    }
}
