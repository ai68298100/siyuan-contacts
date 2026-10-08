import { AI_CANDIDATE_FIELDS, buildExtractionPrompt } from "./ai-extract.ts";
import type { AiCandidateField } from "./ai-extract.ts";

export const AI_KERNEL_ENDPOINT = "/api/ai/chatGPT";
export type AiSourceKind = "document" | "selection" | "paste";

export interface AiPreflightOptions {
    sourceKind?: AiSourceKind;
    sourceText?: string;
    fields?: readonly AiCandidateField[];
    removeContacts?: boolean;
}

export interface AiPreflight {
    readonly id: string;
    readonly endpoint: typeof AI_KERNEL_ENDPOINT;
    readonly downstream: "host_pending";
    readonly sourceDocId: string;
    readonly sourceKind: AiSourceKind;
    readonly sourceText: string;
    readonly sentText: string;
    readonly msg: string;
    readonly characters: number;
    readonly bytes: number;
    readonly fields: readonly AiCandidateField[];
    readonly removeContacts: boolean;
    readonly removed: Readonly<{ contacts: number; metadata: number; truncated: number }>;
}

class AiPreflightSnapshot {}

export function buildAiPreflight(id: string, sourceDocId: string, sourceText: string, options: AiPreflightOptions = {}): AiPreflight {
    const fields = [...new Set((options.fields ?? AI_CANDIDATE_FIELDS).filter((field) => AI_CANDIDATE_FIELDS.includes(field)))];
    const removed = { contacts: 0, metadata: 0, truncated: 0 };
    let sentText = sourceText.replace(/\{:[^}\r\n]*\}/g, () => { removed.metadata += 1; return ""; })
        .replace(/\(\(\d{14}-[a-z0-9]{7}(?:\s+["']([^"']*)["'])?\)\)/g, (_match, label: string | undefined) => { removed.metadata += 1; return label ?? "[引用已去除]"; })
        .replace(/\{\{[^}\r\n]*\}\}/g, () => { removed.metadata += 1; return "[嵌入已去除]"; })
        .replace(/siyuan:\/\/blocks\/\d{14}-[a-z0-9]{7}(?:\?[^\s)]+)?/g, () => { removed.metadata += 1; return "[链接目标已去除]"; });
    const removeContacts = options.removeContacts !== false;
    if (removeContacts) {
        sentText = sentText.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, () => { removed.contacts += 1; return "[邮箱已去除]"; })
            .replace(/(?<![\d\w])(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)|(?<!\d)0\d{2,3}[-\s]?\d{7,8}(?!\d)|(?<![\d\w])\+\d[\d -]{6,18}\d(?!\d)/g,
                () => { removed.contacts += 1; return "[电话已去除]"; });
    }
    const characters = Array.from(sentText);
    removed.truncated = Math.max(0, characters.length - 6000);
    sentText = characters.slice(0, 6000).join("");
    const msg = buildExtractionPrompt(sentText, [], fields);
    const snapshot: AiPreflight = {
        id, endpoint: AI_KERNEL_ENDPOINT, downstream: "host_pending", sourceDocId,
        sourceKind: options.sourceKind ?? "document", sourceText, sentText, msg,
        characters: Array.from(msg).length, bytes: new TextEncoder().encode(msg).length,
        fields: Object.freeze(fields), removeContacts, removed: Object.freeze(removed),
    };
    return Object.freeze(Object.assign(new AiPreflightSnapshot(), snapshot));
}

export type AiFailureCode = "confirmation_required" | "disabled" | "source_unavailable" | "unconfigured" | "permission" | "timeout" | "cancelled" | "protocol" | "request_failed";

export class AiExtractionError extends Error {
    readonly code: AiFailureCode;

    constructor(code: AiFailureCode) {
        const messages: Record<AiFailureCode, string> = {
            confirmation_required: "请重新预览并明确确认本次发送文本。",
            disabled: "AI 已关闭，可继续手动捕获。",
            source_unavailable: "来源读取失败，未发送；可提供选段或粘贴文本。",
            unconfigured: "思源 AI 尚未配置，可继续手动捕获。",
            permission: "AI 请求权限不足，未回填候选。",
            timeout: "AI 请求超时，迟到结果将忽略；可继续手动捕获。",
            cancelled: "AI 分析已取消，结果不会回填。",
            protocol: "AI 返回无效结果，可继续手动捕获。",
            request_failed: "AI 请求失败，可继续手动捕获。",
        };
        super(messages[code]);
        this.name = "AiExtractionError";
        this.code = code;
    }
}
