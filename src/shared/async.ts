/**
 * 通用异步辅助（CODE-02.6）：可单测的限时等待。
 * 注意：只放弃等待，不中止底层任务（思源 fetchPost 无中止能力）——超时错误须可识别，
 * 让调用方决定是否重试；写入类请求严禁自动重试（可能产生重复块/重复文档）。
 */

/** 超时后以 `${label} 请求超时（${timeoutMs}ms）` 拒绝；正常完成/失败立即清除定时器 */
export function withTimeout<T>(task: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} 请求超时（${timeoutMs}ms）`));
        }, timeoutMs);
        task().then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}
