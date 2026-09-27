/**
 * AI 人名抽取的纯函数部分：提示词组装与回复解析。
 * 网络流程（读笔记 → 调思源内置 AI）在 services/ai-extract.ts。
 * 边界：AI 只提名不做决定——结果必须经确认 UI 由用户勾选后才落库。
 */

export interface ExtractionResult {
    /** 抽取的人名（去重、去空、最多 20 个） */
    names: string[];
    /** YYYY-MM-DD（AI 识别到的场合日期，可能缺省） */
    date?: string;
    place?: string;
}

export const MAX_NAMES = 20;

export function buildExtractionPrompt(content: string, rosterNames: readonly string[]): string {
    const known = rosterNames.length > 0 ? rosterNames.slice(0, 500).join("、") : "（暂无）";
    const trimmed = content.length > 6000 ? `${content.slice(0, 6000)}\n…（已截断）` : content;
    return [
        "从下面的笔记中抽取人物与场合信息。要求：",
        "1. people 是笔记中提到的所有人名（去重，最多 20 个），已知人脉名单仅供参考匹配，名单外的人名同样要抽出来；",
        "2. date 是笔记中提到的场合日期（YYYY-MM-DD），没有则为 null；",
        "3. place 是笔记中提到的地点，没有则为 null；",
        '4. 只输出一个 JSON 对象，形如 {"people":["张三","李四"],"date":"2026-09-27","place":"会议室"}，不要输出任何其他文字。',
        `已知人脉名单：${known}`,
        "笔记内容：",
        "```",
        trimmed,
        "```",
    ].join("\n");
}

/** 从 AI 回复中解析抽取结果；无法解析返回 null（UI 提示检查 AI 配置） */
export function parseExtraction(reply: string): ExtractionResult | null {
    if (!reply) return null;
    const start = reply.indexOf("{");
    const end = reply.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(reply.slice(start, end + 1));
    } catch {
        return null;
    }
    if (parsed === null || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;

    const names: string[] = [];
    const seen = new Set<string>();
    if (Array.isArray(record.people)) {
        for (const item of record.people) {
            if (typeof item !== "string") continue;
            const name = item.trim();
            if (!name || name.length > 20 || seen.has(name)) continue;
            if (/^\d+$/.test(name)) continue;
            seen.add(name);
            names.push(name);
            if (names.length >= MAX_NAMES) break;
        }
    }
    const result: ExtractionResult = { names };
    if (typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
        result.date = record.date;
    }
    if (typeof record.place === "string" && record.place.trim()) {
        result.place = record.place.trim();
    }
    return result;
}
