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
        const reread = await loadJson(plugin, key);
        if (JSON.stringify(reread) === expected) return;
    }
    throw new Error(`存储写入未收敛: ${key}`);
}

/**
 * 读-改-写临界区。无 Web Locks 时按键在本上下文排队，不提供跨窗口排他。
 *
 * 锁守护（回归环境曾现「锁 held 不释放」假死）：navigator.locks.request 无超时，
 * 持有方临界区内任一 await 挂死即整键不可用。因此取锁带中止信号；**连续
 * stealAfterWaits+1 次超时才判定持有方真挂死**，以 steal 模式接管自愈——挂死者
 * 不会再写入，接管不丢其数据；首次超时后先按原样重新排队（宽限），正常慢写
 * （大库慢回读）在宽限内完成即被串行化，不与接管者的读改写重叠（FUNC-01.13）。
 * 非中止类锁错误照常抛出不绕过保护（契约语义不变）。超时与宽限次数可配置
 * （storeLockConfig），测试里缩短以验证接管路径。
 */
/** 取锁等待上限与接管宽限（可按环境调整；测试里缩短以验证接管路径） */
export const storeLockConfig = {
    acquireTimeoutMs: 5_000,
    /** 首次超时后的宽限重试次数：连续 N+1 次超时才 steal（0 = 首次超时立即接管） */
    stealAfterWaits: 1,
};

function isAbortError(error: unknown): boolean {
    return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}

function requestLockGuarded<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), storeLockConfig.acquireTimeoutMs);
        navigator.locks!.request(name, { signal: controller.signal }, fn).then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
}

export async function withStoreLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
        const name = `lvct-${key}`;
        let aborts = 0;
        while (true) {
            try {
                return await requestLockGuarded(name, fn);
            } catch (error) {
                if (!isAbortError(error)) throw error;
                aborts += 1;
                if (aborts <= storeLockConfig.stealAfterWaits) continue; /* 宽限：先按原样重新排队 */
            }
            console.warn(`[lvct] 存储锁连续 ${aborts} 次等待超时，判定持有方挂死，接管继续: ${key}`);
            return navigator.locks.request(name, { steal: true }, fn);
        }
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
