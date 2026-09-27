/**
 * 插件自管 JSON 的存储纪律层（唯一允许碰 loadData/saveData 的地方）。
 * 纪律来自小驴打卡 D-138/139/141/221/222：
 * - saveData 的 Promise 完成只代表宿主接受了写请求，必须写后回读验证；
 * - 读-改-写临界区用 Web Locks 排他，防多窗口并发互相覆盖；
 * - onDataChanged 必须被插件覆写，否则宿主会整插件重载（见 index.ts）。
 */
import type { Plugin } from "siyuan";

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
 * 读-改-写临界区。无 Web Locks 的环境降级为直接执行（桌面思源均支持）。
 */
export async function withStoreLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
        return navigator.locks.request(`lvct-${key}`, fn);
    }
    return fn();
}
