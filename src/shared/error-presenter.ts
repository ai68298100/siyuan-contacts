import { AsyncOperationError } from "./async.ts";
import {
    KernelError,
    KernelPermissionError,
    KernelProtocolError,
    KernelResponseError,
    KernelTransportError,
} from "../api/kernel-contract.ts";

export type RequestErrorKind = "permission" | "timeout" | "transport" | "cancelled" | "protocol" | "kernel" | "unknown";

export interface RequestErrorPresentation {
    kind: RequestErrorKind;
    /** 可直接展示给用户的简短说明。 */
    message: string;
    /** 完成纠正或确认后，是否适合提供重试入口。 */
    retryable: boolean;
}

/**
 * 页面层统一使用的错误文案入口：边界错误走可操作的中文提示，业务校验错误
 * 保留服务层已经写好的具体原因，避免把“名称不能为空”等字段反馈抹掉。
 */
export function requestErrorMessage(error: unknown, fallback = "操作未完成，请检查后重试。"): string {
    if (error instanceof KernelPermissionError || error instanceof AsyncOperationError
        || error instanceof KernelTransportError || error instanceof KernelProtocolError
        || error instanceof KernelResponseError || error instanceof KernelError) {
        return presentRequestError(error).message;
    }
    // UI 宿主可能从 iframe/插件边界传回另一 Realm 的 Error，不能依赖
    // `instanceof Error`，否则会把可恢复的锁超时/业务校验降级成笼统提示。
    if (error instanceof Error && error.message.trim()) return error.message;
    if (isCrossRealmError(error)) return error.message;
    return fallback;
}

function isCrossRealmError(error: unknown): error is { name?: string; message: string } {
    if (typeof error !== "object" || error === null) return false;
    const message = (error as { message?: unknown }).message;
    if (typeof message !== "string" || !message.trim()) return false;
    const name = (error as { name?: unknown }).name;
    // 只接纳明确的错误对象形状；普通对象/宿主响应不会被直接 stringify 到界面。
    return typeof name === "string" && name.length > 0;
}

function readableDetail(value: string | undefined): string {
    const detail = value?.replace(/\s+/g, " ").trim();
    return detail ? `（${detail}）` : "";
}

/** 将内核/API 边界错误转换为简洁、可操作的界面文案。此处不修改宿主登录态。 */
export function presentRequestError(error: unknown): RequestErrorPresentation {
    if (error instanceof KernelPermissionError) {
        if (error.code === 401) {
            return {
                kind: "permission",
                message: "思源登录状态可能已失效。请先在思源中确认账号仍处于登录状态，再重新读取。",
                retryable: true,
            };
        }
        if (error.code === 403) {
            return {
                kind: "permission",
                message: "当前思源用户没有访问这部分数据的权限。请检查笔记本、文档或数据库权限，调整后再重试。",
                retryable: true,
            };
        }
        return {
            kind: "permission",
            message: `思源拒绝了本次访问，当前用户可能没有目标数据的权限${readableDetail(error.responseMessage)}。检查权限后可重试。`,
            retryable: true,
        };
    }

    if (error instanceof AsyncOperationError) {
        if (error.kind === "timeout") {
            return {
                kind: "timeout",
                message: "等待思源返回数据超时。请检查思源是否仍在运行，稍后重新读取。",
                retryable: true,
            };
        }
        return { kind: "cancelled", message: "本次读取已取消。", retryable: false };
    }

    if (error instanceof KernelTransportError) {
        return {
            kind: "transport",
            message: "无法连接思源内核。请确认思源正在正常运行，然后重新读取。",
            retryable: true,
        };
    }

    if (error instanceof KernelProtocolError) {
        return {
            kind: "protocol",
            message: "思源返回的数据格式无法识别，数据未按空结果处理。请重新读取；若仍出现，请检查思源版本兼容性。",
            retryable: true,
        };
    }

    if (error instanceof KernelResponseError) {
        return {
            kind: "kernel",
            message: `思源内核未能完成本次请求${readableDetail(error.responseMessage)}。请核对数据状态后重试。`,
            retryable: true,
        };
    }

    if (error instanceof KernelError) {
        return {
            kind: error.kind === "permission" ? "permission" : error.kind === "transport" ? "transport" : error.kind === "protocol" ? "protocol" : "kernel",
            message: "思源内核未能完成本次请求。请检查数据状态后重试。",
            retryable: true,
        };
    }

    return {
        kind: "unknown",
        message: "读取未完成。请检查思源状态后重试。",
        retryable: true,
    };
}

