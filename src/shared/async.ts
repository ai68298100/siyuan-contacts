export type AsyncFailureKind = "timeout" | "aborted";

export class AsyncOperationError extends Error {
    readonly kind: AsyncFailureKind;

    constructor(kind: AsyncFailureKind, message: string) {
        super(message);
        this.name = "AsyncOperationError";
        this.kind = kind;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class AsyncTimeoutError extends AsyncOperationError {
    readonly timeoutMs: number;

    constructor(label: string, timeoutMs: number) {
        super("timeout", `${label} 请求超时（${timeoutMs}ms）`);
        this.name = "AsyncTimeoutError";
        this.timeoutMs = timeoutMs;
    }
}

export class AsyncAbortError extends AsyncOperationError {
    constructor(label: string) {
        super("aborted", `${label} 请求已取消`);
        this.name = "AsyncAbortError";
    }
}

export interface AsyncControlOptions {
    signal?: AbortSignal;
}

export function withTimeout<T>(
    task: () => Promise<T>,
    timeoutMs: number,
    label: string,
    options: AsyncControlOptions = {},
): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError("timeoutMs 必须是正数");
    }

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => settleFailure(new AsyncTimeoutError(label, timeoutMs)), timeoutMs);
        const signal = options.signal;

        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", handleAbort);
        };

        const settleSuccess = (value: T) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        };

        const settleFailure = (error: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };

        const handleAbort = () => settleFailure(new AsyncAbortError(label));
        if (signal?.aborted) {
            handleAbort();
            return;
        }
        signal?.addEventListener("abort", handleAbort, { once: true });

        let taskPromise: Promise<T>;
        try {
            taskPromise = task();
        } catch (error) {
            settleFailure(error);
            return;
        }
        taskPromise.then(settleSuccess, settleFailure);
    });
}

export function isAbortError(error: unknown): boolean {
    if (error instanceof AsyncAbortError) return true;
    if (typeof DOMException !== "undefined" && error instanceof DOMException) {
        return error.name === "AbortError";
    }
    return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
