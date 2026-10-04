/**
 * 思源内置 AI（设置-人工智能中由用户配置模型与密钥）。
 * 插件不持有任何密钥；笔记内容仅在用户显式触发分析时发送。
 */
import { decodeString, kernelPost } from "./client";
import { AI_KERNEL_ENDPOINT, AiExtractionError } from "../domain/ai-preflight";
import type { AiPreflight } from "../domain/ai-preflight";

/** 调用思源内置 AI 对话，返回回复文本。未配置/失败时内核返回错误文本，由调用方判定 */
export async function aiChat(preflight: AiPreflight, confirmed: boolean, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string> {
    if (!confirmed || preflight.endpoint !== AI_KERNEL_ENDPOINT) throw new AiExtractionError("confirmation_required");
    return kernelPost(AI_KERNEL_ENDPOINT, { msg: preflight.msg }, {
        ...options,
        decode: (data) => decodeString(AI_KERNEL_ENDPOINT, data),
    });
}
