/**
 * 今日/本周行动清单（F07）：把生日、联系节奏与跟进事项三个来源合并为按人聚合的行动卡。
 * 只读投影，无存储；同一人命中多个原因只出一张卡、挂多枚原因徽标；
 * 不使用重要度/关系强度评分，排序只用桶优先级 + 最早日期 + 姓名，稳定可复现。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */
import type { ContactSummary } from "./person";

export type ActionBucket = "overdue" | "today" | "week" | "stale";

export interface ActionReason {
    kind: "birthday" | "stale" | "followup";
    label: string;
    bucket: ActionBucket;
    /** 相关的具体日期（YYYY-MM-DD）；持续关注类无日期 */
    dueDate?: string;
    /** 跟进原因的操作句柄 */
    followUpId?: string;
}

export interface ActionCard {
    person: ContactSummary;
    /** 卡片紧急度取原因中最高（overdue > today > week > stale） */
    bucket: ActionBucket;
    reasons: ActionReason[];
    /** 最早具体日期，用于稳定排序；仅持续关注原因为 undefined */
    earliestDate?: string;
}

export interface ActionPersonInput {
    person: ContactSummary;
    /** 距下次生日天数（今天=0）；undefined = 7 天窗口外或未填生日 */
    birthdayDaysUntil?: number;
    birthdayDate?: string;
    /** 距上次互动天数；undefined = 从未互动 */
    lastDaysAgo?: number;
    /** 有值表示该人在久未联系名单中，用此（生效）阈值生成理由 */
    staleThreshold?: number;
    /** 到期日在今天或未来的跟进事项（逾期也传入） */
    followUps: readonly { id: string; title: string; dueDate: string }[];
}

const BUCKET_PRIORITY: Record<ActionBucket, number> = { overdue: 0, today: 1, week: 2, stale: 3 };
const WEEK_HORIZON = 7;

export function buildActionCards(
    inputs: readonly ActionPersonInput[],
    today: string,
): ActionCard[] {
    const cards: ActionCard[] = [];
    for (const input of inputs) {
        const reasons: ActionReason[] = [];
        if (input.birthdayDaysUntil !== undefined && input.birthdayDaysUntil <= WEEK_HORIZON) {
            reasons.push({
                kind: "birthday",
                bucket: input.birthdayDaysUntil === 0 ? "today" : "week",
                label: input.birthdayDaysUntil === 0 ? "今天生日" : `${input.birthdayDaysUntil} 天后生日`,
                dueDate: input.birthdayDate,
            });
        }
        if (input.staleThreshold !== undefined) {
            reasons.push({
                kind: "stale",
                bucket: "stale",
                label: input.lastDaysAgo === undefined
                    ? "从未互动"
                    : `${input.lastDaysAgo} 天未联系（阈值 ${input.staleThreshold} 天）`,
            });
        }
        for (const followUp of input.followUps) {
            if (!followUp.dueDate || followUp.dueDate > addDays(today, WEEK_HORIZON)) continue;
            const bucket: ActionBucket = followUp.dueDate < today ? "overdue" : followUp.dueDate === today ? "today" : "week";
            const title = followUp.title || "保持联系";
            reasons.push({
                kind: "followup",
                bucket,
                label: bucket === "overdue" ? `跟进「${title}」已逾期` : bucket === "today" ? `跟进「${title}」今天到期` : `跟进「${title}」`,
                dueDate: followUp.dueDate,
                followUpId: followUp.id,
            });
        }
        if (reasons.length === 0) continue;
        const dated = reasons.map((reason) => reason.dueDate).filter((date): date is string => Boolean(date)).sort();
        cards.push({
            person: input.person,
            bucket: reasons.reduce((min, reason) => (BUCKET_PRIORITY[reason.bucket] < BUCKET_PRIORITY[min] ? reason.bucket : min), "stale" as ActionBucket),
            reasons: reasons.sort((a, b) => BUCKET_PRIORITY[a.bucket] - BUCKET_PRIORITY[b.bucket]),
            ...(dated.length > 0 ? { earliestDate: dated[0] } : {}),
        });
    }
    return cards.sort((a, b) =>
        BUCKET_PRIORITY[a.bucket] - BUCKET_PRIORITY[b.bucket] ||
        (a.earliestDate ?? "9999-12-31").localeCompare(b.earliestDate ?? "9999-12-31") ||
        a.person.name.localeCompare(b.person.name, "zh-CN"));
}

function addDays(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, day + days);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
