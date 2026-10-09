export interface KernelResponse<T> {
    code: number;
    msg: string;
    data: T;
}

export type KernelFailureKind = "protocol" | "permission" | "kernel" | "transport";

export class KernelError extends Error {
    readonly kind: KernelFailureKind;
    readonly route: string;
    readonly code?: number;
    readonly responseMessage?: string;

    constructor(
        kind: KernelFailureKind,
        route: string,
        message: string,
        code?: number,
        responseMessage?: string,
    ) {
        super(message);
        this.name = "KernelError";
        this.kind = kind;
        this.route = route;
        this.code = code;
        this.responseMessage = responseMessage;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class KernelProtocolError extends KernelError {
    constructor(route: string, message: string) {
        super("protocol", route, message);
        this.name = "KernelProtocolError";
    }
}

export class KernelPermissionError extends KernelError {
    constructor(route: string, code: number, responseMessage: string) {
        super("permission", route, `${route} 权限失败 code=${code} msg=${responseMessage}`, code, responseMessage);
        this.name = "KernelPermissionError";
    }
}

export class KernelResponseError extends KernelError {
    constructor(route: string, code: number, responseMessage: string) {
        super("kernel", route, `${route} code=${code} msg=${responseMessage}`, code, responseMessage);
        this.name = "KernelResponseError";
    }
}

export class KernelTransportError extends KernelError {
    readonly cause: unknown;

    constructor(route: string, cause: unknown) {
        const detail = cause instanceof Error ? cause.message : String(cause ?? "未知传输错误");
        super("transport", route, `${route} 传输失败：${detail}`);
        this.name = "KernelTransportError";
        this.cause = cause;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function isPermissionMessage(message: string): boolean {
    return /permission|forbidden|unauthori[sz]ed|权限|未授权|无权|禁止访问/i.test(message);
}

export function decodeKernelResponse<T>(route: string, response: unknown): KernelResponse<T> {
    if (!isRecord(response)) {
        throw new KernelProtocolError(route, `${route} 返回异常响应`);
    }

    const code = response.code;
    const message = response.msg;
    if (typeof code !== "number" || !Number.isInteger(code) || !Number.isFinite(code)) {
        throw new KernelProtocolError(route, `${route} 返回异常响应（code 缺失或非法）`);
    }
    if (typeof message !== "string") {
        throw new KernelProtocolError(route, `${route} 返回异常响应（msg 缺失或非法）`);
    }

    if (code !== 0) {
        if (code === 401 || code === 403 || isPermissionMessage(message)) {
            throw new KernelPermissionError(route, code, message);
        }
        throw new KernelResponseError(route, code, message);
    }

    if (!hasOwn(response, "data")) {
        throw new KernelProtocolError(route, `${route} 成功响应缺少 data`);
    }

    return { code, msg: message, data: response.data as T };
}

export type KernelDataState = "empty" | "value";

export function classifyKernelData(value: unknown): KernelDataState {
    if (value === null || value === undefined) return "empty";
    if (Array.isArray(value)) return value.length === 0 ? "empty" : "value";
    if (typeof value === "string") return value.trim().length === 0 ? "empty" : "value";
    return "value";
}

export function assertKernelArray<T>(route: string, value: unknown): T[] {
    if (!Array.isArray(value)) {
        throw new KernelProtocolError(route, `${route} 返回异常形状（非数组）`);
    }
    return value as T[];
}

export function assertKernelRecord(route: string, value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new KernelProtocolError(route, `${route} 返回异常形状（非对象）`);
    }
    return value;
}

/**
 * 解码内核返回的文档/块 ID。
 * createDocWithMd 的返回值会被多个服务写入事实关系，不能把错误文本当作 ID 持久化。
 */
export function decodeNodeId(route: string, value: unknown): string {
    if (typeof value !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(value)) {
        throw new KernelProtocolError(route, `${route} 返回异常形状（非法节点 ID）`);
    }
    return value;
}
