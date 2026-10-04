/**
 * 插件自管 JSON 的存储纪律层（唯一允许碰 loadData/saveData 的地方）。
 * 纪律来自小驴打卡 D-138/139/141/221/222：
 * - saveData 的 Promise 完成只代表宿主接受了写请求，必须写后回读验证；
 * - 读-改-写临界区用 Web Locks 排他，防多窗口并发互相覆盖；
 * - onDataChanged 必须被插件覆写，否则宿主会整插件重载（见 index.ts）。
 */
import type { Plugin } from "siyuan";

const localQueues = new Map<string, Promise<void>>();

/** 写操作的前置读取：读取异常必须传递，不能按空库覆盖已有数据。 */
export async function loadJsonStrict(plugin: Plugin, key: string): Promise<unknown | null> {
    try {
        return (await plugin.loadData(key)) ?? null;
    } catch (cause) {
        throw new Error(`存储读取失败，操作已停止: ${key}`, { cause });
    }
}

/** 读原始 JSON；键不存在或读取失败一律返回 null，绝不阻断启动 */
export async function loadJson(plugin: Plugin, key: string): Promise<unknown | null> {
    try {
        return await loadJsonStrict(plugin, key);
    } catch {
        return null;
    }
}

/**
 * 写入并回读验证：两次不收敛按真失败抛错（调用方决定如何提示）。
 */
export async function saveJsonVerified(plugin: Plugin, key: string, value: unknown): Promise<void> {
    const expected = JSON.stringify(value);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await plugin.saveData(key, value);
        const reread = await loadJsonStrict(plugin, key);
        if (JSON.stringify(reread) === expected) return;
    }
    throw new Error(`存储写入未收敛: ${key}`);
}

export const storeLockConfig = {
    acquireTimeoutMs: 5_000,
    acquireRetryCount: 1,
};

export class StoreLockTimeoutError extends Error {
    readonly key: string;
    readonly timeoutMs: number;
    readonly attempts: number;

    constructor(key: string, timeoutMs: number, attempts: number) {
        super(`存储仍被其他操作占用，等待超时（每次 ${timeoutMs}ms，共 ${attempts} 次）: ${key}。此次操作尚未执行，请等待原操作结束并核实结果后重试。`);
        this.name = "StoreLockTimeoutError";
        this.key = key;
        this.timeoutMs = timeoutMs;
        this.attempts = attempts;
    }
}

function isAbortError(error: unknown): boolean {
    return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}

async function requestLockGuarded<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const { acquireTimeoutMs, acquireRetryCount } = storeLockConfig;
    if (!Number.isSafeInteger(acquireTimeoutMs) || acquireTimeoutMs < 1 || acquireTimeoutMs > 2_147_483_647
        || !Number.isSafeInteger(acquireRetryCount) || acquireRetryCount < 0) {
        throw new RangeError("存储锁等待时长必须为正整数，重试次数必须为非负整数");
    }
    for (let attempt = 0; attempt <= acquireRetryCount; attempt += 1) {
        const controller = new AbortController();
        let acquired = false;
        const timer = setTimeout(() => controller.abort(), acquireTimeoutMs);
        try {
            return await navigator.locks.request(`lvct-${key}`, { signal: controller.signal }, () => {
                acquired = true;
                clearTimeout(timer);
                return fn();
            });
        } catch (error) {
            if (acquired || !controller.signal.aborted || !isAbortError(error)) throw error;
            if (attempt === acquireRetryCount) throw new StoreLockTimeoutError(key, acquireTimeoutMs, attempt + 1);
        } finally {
            clearTimeout(timer);
        }
    }
    throw new StoreLockTimeoutError(key, acquireTimeoutMs, acquireRetryCount + 1);
}

export async function withStoreLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (typeof navigator !== "undefined" && typeof navigator.locks?.request === "function") {
        return requestLockGuarded(key, fn);
    }
    const previous = localQueues.get(key) ?? Promise.resolve();
    const task = previous.then(fn);
    const completion = task.then(() => {}, () => {});
    localQueues.set(key, completion);
    try {
        return await task;
    } finally {
        if (localQueues.get(key) === completion) localQueues.delete(key);
    }
}
