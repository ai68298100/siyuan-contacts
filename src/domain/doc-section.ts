/**
 * 人脉文档各原子区块的 Markdown 纯函数渲染与属性标记契约。
 * 纯函数，零外部依赖（严格遵守 domain/ 架构约束）。
 */
import type { ContactSummary } from "./person.ts";
import type { InteractionEvent } from "./interactions.ts";
import { profileText } from "./people-profiles.ts";
import type { FollowUpItem } from "./followups.ts";
import type { ExchangeRecord } from "./exchanges.ts";
import type { AnniversaryItem } from "./anniversaries.ts";
import { escapeLinkLabel } from "./format.ts";

export const RELATED_SECTION_ATTR = "custom-lvct-related";
export const INTERACTIONS_SECTION_ATTR = "custom-lvct-interactions";
export const PROFILE_SECTION_ATTR = "custom-lvct-profile";
export const FOLLOWUPS_SECTION_ATTR = "custom-lvct-followups";
export const EXCHANGES_SECTION_ATTR = "custom-lvct-exchanges";
export const ANNIVERSARIES_SECTION_ATTR = "custom-lvct-anniversaries";

export function profileSectionMarkdown(person: ContactSummary): string {
    const lines = ["## 人脉基本档案", ""];
    if (person.phone) lines.push(`- **电话**：${person.phone}`);
    if (person.wechat) lines.push(`- **微信**：${person.wechat}`);
    if (person.email) lines.push(`- **邮箱**：${person.email}`);
    if (person.birthday) {
        const bdayStr = person.isLunar ? `${person.birthday}（农历）` : person.birthday;
        lines.push(`- **生日**：${bdayStr}`);
    }
    if (person.group) lines.push(`- **分组**：${person.group}`);
    if (person.tags && person.tags.length > 0) lines.push(`- **标签**：${person.tags.map((t) => `#${t}`).join(" ")}`);
    if (person.profile) {
        const work = profileText(person.profile, "work");
        const edu = profileText(person.profile, "education");
        const fam = profileText(person.profile, "family");
        const rel = profileText(person.profile, "relationship");
        if (work && work !== "—") lines.push(`- **工作单位**：${work}`);
        if (edu && edu !== "—") lines.push(`- **学校**：${edu}`);
        if (fam && fam !== "—") lines.push(`- **家庭**：${fam}`);
        if (rel && rel !== "—") lines.push(`- **与我的关系**：${rel}`);
    }
    if (lines.length <= 2) return "";
    return lines.join("\n");
}

function cleanMarkdownLine(text: string | undefined): string {
    if (!text) return "";
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+/g, " <br /> ").trim();
}

const INTERACTION_ICONS: Record<string, string> = {
    meet: "🤝 见面",
    call: "📞 电话",
    message: "💬 消息",
    meal: "🍽️ 聚餐",
    mail: "✉️ 邮件",
    other: "📝 互动",
};

export function interactionSectionMarkdown(events: readonly InteractionEvent[]): string {
    if (events.length === 0) return "";
    const lines = ["## 往来记录", ""];
    for (const event of events) {
        const typeStr = (event.type && INTERACTION_ICONS[event.type]) ? INTERACTION_ICONS[event.type] : "📝 互动";
        const note = cleanMarkdownLine(event.note);
        const noteStr = note ? `：${note}` : "";
        lines.push(`- ${event.localDate} ${typeStr}${noteStr}`);
    }
    return lines.join("\n");
}

export function followupsSectionMarkdown(items: readonly FollowUpItem[]): string {
    const valid = items.filter((item) => item.status !== "cancelled");
    if (valid.length === 0) return "";
    const lines = ["## 待办跟进", ""];
    for (const item of valid) {
        const checked = item.status === "done" ? "[x]" : "[ ]";
        const title = cleanMarkdownLine(item.title) || "保持联系";
        lines.push(`- ${checked} 📅${item.dueDate} ${title}`);
    }
    return lines.join("\n");
}

const DIRECTION_LABELS: Record<string, string> = {
    receivable: "应收/收到",
    payable: "应付/送出",
};
const STATUS_LABELS: Record<string, string> = {
    open: "进行中",
    settled: "已结清",
    cancelled: "已取消",
};

export function exchangesSectionMarkdown(items: readonly ExchangeRecord[]): string {
    const valid = items.filter((item) => item.status !== "cancelled");
    if (valid.length === 0) return "";
    const lines = ["## 人情往来", ""];
    for (const item of valid) {
        const dir = DIRECTION_LABELS[item.direction] || "往来";
        const amountStr = item.amount ? ` (${item.currency || "¥"}${item.amount})` : "";
        const statusStr = STATUS_LABELS[item.status] ? ` [${STATUS_LABELS[item.status]}]` : "";
        const dateStr = item.occurredOn || item.dueOn || "";
        const desc = cleanMarkdownLine(item.description);
        lines.push(`- ${dateStr} ${dir}：${desc}${amountStr}${statusStr}`);
    }
    return lines.join("\n");
}

export function anniversariesSectionMarkdown(items: readonly AnniversaryItem[]): string {
    if (items.length === 0) return "";
    const lines = ["## 重要纪念日", ""];
    for (const item of items) {
        const lunarTag = item.isLunar ? "（农历）" : "";
        lines.push(`- ${item.title}：${item.date}${lunarTag}`);
    }
    return lines.join("\n");
}

export function relatedSectionMarkdown(related: readonly ContactSummary[]): string {
    const links = related.map((item) => `[${escapeLinkLabel(item.name)}](siyuan://blocks/${item.docId})`);
    return `**相关人物**：${links.join("、")}`;
}
