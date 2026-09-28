/**
 * AI 人名抽取的纯函数部分：提示词组装与回复解析。
 * 网络流程（读笔记 → 调思源内置 AI）在 services/ai-extract.ts。
 * 边界：AI 只提名不做决定——结果必须经确认 UI 由用户勾选后才落库。
 */

import { isValidDateKey } from "./followups.ts";

export interface ExtractionResult {
    /** 抽取的人名（去重、去空、最多 20 个） */
    names: string[];
    /** YYYY-MM-DD（AI 识别到的场合日期，可能缺省） */
    date?: string;
    place?: string;
    /** FAST-01.4：互动场合说明建议（预填捕获备注；契约仍为当日+地点+备注） */
    occasion?: string;
    /** 互动备注建议（预填捕获备注） */
    note?: string;
    /** 资料补充建议（勾选确认后走 updateContactFields，只补缺失字段） */
    profileCandidates: ProfileCandidate[];
    /** 跟进候选（勾选确认后走 createFollowUp） */
    followUpCandidates: FollowUpCandidate[];
    /** 关系候选（当前无契约支持，仅展示建议文本，不写库） */
    relationCandidates: RelationCandidate[];
    /** 解析时因非法/超限被丢弃的条目数（可解释性） */
    rejected: number;
}

export const PROFILE_FIELDS = ["phone", "wechat", "email", "website", "birthday"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export interface ProfileCandidate {
    person: string;
    field: ProfileField;
    /** 归一化后的建议值（长度上限 80） */
    value: string;
}

export interface FollowUpCandidate {
    person: string;
    /** 空串时 UI 用默认标题「联系一下」 */
    title: string;
    dueDate: string;
}

export interface RelationCandidate {
    personA: string;
    personB: string;
    /** 关系词（同事/同学/家人…）；当前版本无关系类型契约，仅展示 */
    relation: string;
}

export const MAX_NAMES = 20;
const MAX_CANDIDATES = 20;
const VALUE_LIMIT = 80;

export function buildExtractionPrompt(content: string, rosterNames: readonly string[]): string {
    const known = rosterNames.length > 0 ? rosterNames.slice(0, 500).join("、") : "（暂无）";
    const trimmed = content.length > 6000 ? `${content.slice(0, 6000)}\n…（已截断）` : content;
    return [
        "从下面的笔记中抽取人物与场合信息，输出一个版本化 JSON 对象。要求：",
        '1. people 是笔记中提到的所有人名（去重，最多 20 个），已知人脉名单仅供参考匹配，名单外的人名同样要抽出来；',
        '2. date/place 是场合日期（YYYY-MM-DD）与地点，没有则为 null；occasion/note 是场合说明与备注摘要，没有则为 null；',
        '3. profileCandidates 是人物资料候选：每项 {person, field, value}，field 只能是 phone/wechat/email/website/birthday 之一；不确定就不要输出；',
        '4. followUpCandidates 是跟进候选：每项 {person, title, dueDate(YYYY-MM-DD)}；笔记明确提到"要跟进/下次联系"才输出；',
        '5. relationCandidates 是关系候选：每项 {personA, personB, relation}（如 同事/同学/家人）；不确定就不要输出；',
        '6. 所有字段缺省一律填 null；不确定的值不要猜；除该 JSON 外不要输出任何其他文字。',
        '形如：{"version":1,"people":["张三"],"date":"2026-09-27","place":null,"occasion":null,"note":null,"profileCandidates":[{"person":"张三","field":"phone","value":"13800000000"}],"followUpCandidates":[],"relationCandidates":[]}',
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
    const result: ExtractionResult = {
        names,
        profileCandidates: [],
        followUpCandidates: [],
        relationCandidates: [],
        rejected: 0,
    };
    if (typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
        result.date = record.date;
    }
    if (typeof record.place === "string" && record.place.trim()) {
        result.place = record.place.trim().slice(0, VALUE_LIMIT);
    }
    if (typeof record.occasion === "string" && record.occasion.trim()) {
        result.occasion = record.occasion.trim().slice(0, VALUE_LIMIT);
    }
    if (typeof record.note === "string" && record.note.trim()) {
        result.note = record.note.trim().slice(0, 200);
    }
    /* FAST-01.4：结构化候选解析——严格校验，非法/超限丢弃并计数，未知字段忽略 */
    if (Array.isArray(record.profileCandidates)) {
        for (const entry of record.profileCandidates) {
            if (result.profileCandidates.length >= MAX_CANDIDATES) break;
            const candidate = entry as Record<string, unknown>;
            const person = typeof candidate.person === "string" ? candidate.person.trim() : "";
            const field = candidate.field;
            const value = typeof candidate.value === "string" || typeof candidate.value === "number"
                ? String(candidate.value).trim()
                : "";
            if (!person || person.length > 20 || typeof field !== "string") { result.rejected += 1; continue; }
            if (!PROFILE_FIELDS.includes(field as ProfileField)) { result.rejected += 1; continue; }
            if (!value || value.length > VALUE_LIMIT) { result.rejected += 1; continue; }
            /* 生日候选需真实日期（非法日期拒绝，FAST-01.4 验收） */
            if (field === "birthday" && !isValidDateKey(value)) { result.rejected += 1; continue; }
            result.profileCandidates.push({ person, field: field as ProfileField, value });
        }
    }
    if (Array.isArray(record.followUpCandidates)) {
        for (const entry of record.followUpCandidates) {
            if (result.followUpCandidates.length >= MAX_CANDIDATES) break;
            const candidate = entry as Record<string, unknown>;
            const person = typeof candidate.person === "string" ? candidate.person.trim() : "";
            const title = typeof candidate.title === "string" ? candidate.title.trim().slice(0, 40) : "";
            const dueDate = typeof candidate.dueDate === "string" && isValidDate(candidate.dueDate) ? candidate.dueDate : "";
            if (!person || !dueDate) { result.rejected += 1; continue; }
            result.followUpCandidates.push({ person, title, dueDate });
        }
    }
    if (Array.isArray(record.relationCandidates)) {
        for (const entry of record.relationCandidates) {
            if (result.relationCandidates.length >= MAX_CANDIDATES) break;
            const candidate = entry as Record<string, unknown>;
            const a = typeof candidate.personA === "string" ? candidate.personA.trim() : "";
            const b = typeof candidate.personB === "string" ? candidate.personB.trim() : "";
            const relation = typeof candidate.relation === "string" ? candidate.relation.trim().slice(0, 20) : "";
            if (!a || !b || !relation) { result.rejected += 1; continue; }
            result.relationCandidates.push({ personA: a, personB: b, relation });
        }
    }
    return result;
}

function isValidDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
