/**
 * AI 人名抽取（v0.2b）：调用思源内置 AI，从笔记中抽取"未链接的人名/日期/地点"。
 * 网络流程只有 fetchDocMarkdown + aiChat 两点；提示词与解析在 domain/ai-extract.ts（纯函数可测）。
 */
import { aiChat } from "../api/ai";
import { fetchDocMarkdown } from "../api/blocks";
import { buildExtractionPrompt, parseExtraction } from "../domain/ai-extract.ts";
import type { ExtractionResult } from "../domain/ai-extract";
import type { ContactSummary } from "../domain/person";
import type { ContactsSettings } from "../domain/model";
import { getRoster } from "./roster";

export type { ExtractionResult };

export interface AiExtractOutcome {
    extraction: ExtractionResult | null;
    /** AI 是否疑似未配置（回复为空或含典型错误措辞） */
    likelyUnconfigured: boolean;
    /** 名册精确匹配到的人（可直接勾选为参与者） */
    matched: ContactSummary[];
    /** 名册外的新人名（预填进收编输入框） */
    unknownNames: string[];
}

/** 抽取全流程：读笔记 → 组装提示（附带名册名单帮助 AI 对齐）→ 调 AI → 解析 → 与名册对账 */
export async function extractFromDoc(settings: ContactsSettings, docId: string): Promise<AiExtractOutcome> {
    const roster = await getRoster(settings);
    const { content } = await fetchDocMarkdown(docId);
    const reply = await aiChat(buildExtractionPrompt(content, roster.map((person) => person.name)));
    const trimmedReply = (reply ?? "").trim();
    const extraction = parseExtraction(trimmedReply);
    const likelyUnconfigured =
        extraction === null &&
        (trimmedReply.length === 0 ||
            /未配置|请先在|API|密钥|令牌|failed|error|not configured/i.test(trimmedReply.slice(0, 200)));
    if (!extraction) {
        return { extraction: null, likelyUnconfigured, matched: [], unknownNames: [] };
    }
    const byName = new Map(roster.map((person) => [person.name, person]));
    const matched: ContactSummary[] = [];
    const unknownNames: string[] = [];
    for (const name of extraction.names) {
        const person = byName.get(name);
        if (person) matched.push(person);
        else unknownNames.push(name);
    }
    return { extraction, likelyUnconfigured, matched, unknownNames };
}
