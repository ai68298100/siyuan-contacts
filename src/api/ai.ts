/**
 * 思源内置 AI（设置-人工智能中由用户配置模型与密钥）。
 * 插件不持有任何密钥；笔记内容仅在用户显式触发分析时发送。
 */
import { kernelPost } from "./client";

/** 调用思源内置 AI 对话，返回回复文本。未配置/失败时内核返回错误文本，由调用方判定 */
export async function aiChat(msg: string): Promise<string> {
    return kernelPost<string>("/api/ai/chatGPT", { msg });
}
