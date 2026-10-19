/**
 * 输入防抖（纯逻辑层，无 DOM 依赖）：高频输入（搜索、拖拽、滚动）只提交稳定后的值。
 * 目标：降低大列表过滤与跨视图广播的计算开销，避免每次按键触发全量重算。
 *
 * 语义：
 * - schedule(value)：记录最新值并（重）设定时器；delayMs 内无新输入才提交。
 * - flush()：立即提交挂起的值（例如失焦、回车、切换视图时）。
 * - cancel() / dispose()：丢弃挂起值并清除定时器（组件卸载时必须调用，防止泄漏）。
 */

export interface Debouncer<T> {
    /** 提交最新输入（重置等待窗口） */
    schedule(value: T): void;
    /** 立即提交挂起值；无挂起时无操作 */
    flush(): void;
    /** 丢弃挂起值并清除定时器 */
    cancel(): void;
    /** 取消并释放（等价 cancel，语义更明确，供 onDestroy 使用） */
    dispose(): void;
    /** 当前是否有待提交的值 */
    readonly pending: boolean;
}

export interface DebounceOptions {
    /** 稳定等待窗口（毫秒）；会被钳制到 [0, 5000] */
    waitMs?: number;
    /** 提交回调 */
    onCommit: (value: unknown) => void;
}

const MAX_WAIT_MS = 5000;

/**
 * 创建可取消、可 flush 的防抖器。
 * 定时器句柄不对外暴露，避免调用方误用；dispose 后所有方法幂等。
 */
export function createDebouncer<T>(options: DebounceOptions): Debouncer<T> {
    const waitMs = typeof options.waitMs === "number" && Number.isFinite(options.waitMs)
        ? Math.max(0, Math.min(MAX_WAIT_MS, Math.round(options.waitMs)))
        : 200;
    const commit = options.onCommit as (value: T) => void;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingValue: T | undefined;
    let hasPending = false;
    let disposed = false;

    const clear = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    return {
        schedule(value: T) {
            if (disposed) return;
            pendingValue = value;
            hasPending = true;
            clear();
            timer = setTimeout(() => {
                timer = null;
                if (disposed || !hasPending) return;
                const value2 = pendingValue as T;
                hasPending = false;
                pendingValue = undefined;
                commit(value2);
            }, waitMs);
        },
        flush() {
            if (disposed || !hasPending) return;
            clear();
            const value = pendingValue as T;
            hasPending = false;
            pendingValue = undefined;
            commit(value);
        },
        cancel() {
            clear();
            hasPending = false;
            pendingValue = undefined;
        },
        dispose() {
            clear();
            hasPending = false;
            pendingValue = undefined;
            disposed = true;
        },
        get pending() {
            return hasPending;
        },
    };
}

/**
 * 节流：保证同一窗口内最多提交一次（与防抖不同——高频持续输入也会按窗口节奏提交）。
 * 用于滚动/拖拽等需要持续反馈但不能每次事件都计算的场景。
 */
export interface Throttler<T> {
    schedule(value: T): void;
    dispose(): void;
}

export function createThrottler<T>(
    waitMs: number,
    onCommit: (value: T) => void,
): Throttler<T> {
    const interval = typeof waitMs === "number" && Number.isFinite(waitMs)
        ? Math.max(0, Math.min(MAX_WAIT_MS, Math.round(waitMs)))
        : 100;
    let lastCommitAt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let trailingValue: T | undefined;
    let hasTrailing = false;
    let disposed = false;

    return {
        schedule(value: T) {
            if (disposed) return;
            const now = Date.now();
            const elapsed = now - lastCommitAt;
            if (elapsed >= interval) {
                lastCommitAt = now;
                onCommit(value);
                return;
            }
            // 窗口内：记录最新值，并安排一次尾随提交（保证最后一次输入不丢失）
            trailingValue = value;
            hasTrailing = true;
            if (timer === null) {
                timer = setTimeout(() => {
                    timer = null;
                    if (disposed || !hasTrailing) return;
                    const latest = trailingValue as T;
                    hasTrailing = false;
                    trailingValue = undefined;
                    lastCommitAt = Date.now();
                    onCommit(latest);
                }, interval - elapsed);
            }
        },
        dispose() {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            hasTrailing = false;
            trailingValue = undefined;
            disposed = true;
        },
    };
}
