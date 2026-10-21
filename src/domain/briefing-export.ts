/**
 * 会面简报 Markdown 导出（F11）：把事实型简报（资料/最近互动/未完成跟进/重要日期/
 * 相关人物/共同出席）渲染为 Markdown 文本。纯本地生成，无 AI、无猜测；
 * generatedAt 由调用方注入，相同输入与生成时间产出完全一致的内容。
 * 交往次数只陈述事实（「同场 N 次」），不表述关系亲疏。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */
import { formatBirthdayDisplay, nextBirthday } from "./occasions.ts";
import type { ContactSummary } from "./person.ts";
import { escapeMarkdown, sanitizeFileName } from "./format.ts";
import { profileText } from "./people-profiles.ts";
export { escapeMarkdown, sanitizeFileName } from "./format.ts";

export interface BriefingTimelineEntry {
    localDate: string;
    note?: string;
    source: string;
    groupSize: number;
}

export interface BriefingFollowUp {
    title: string;
    dueDate: string;
}

export interface BriefingAnniversary {
    title: string;
    category?: string;
    date: string;
    isLunar?: boolean;
    daysUntil?: number;
    yearsCount?: number;
    displayDate?: string;
}

export interface BriefingExchange {
    kind: string;
    direction: string;
    description: string;
    amount?: number;
    currency?: string;
    occurredOn: string;
    status: string;
}

export interface BriefingCommonOrgPeer {
    name: string;
    samePeriod?: boolean;
    overlapText?: string;
}

export interface BriefingCommonOrg {
    orgName: string;
    peers?: readonly (string | BriefingCommonOrgPeer)[];
}

export interface BriefingExportInput {
    person: ContactSummary;
    timeline: readonly BriefingTimelineEntry[];
    followUps: readonly BriefingFollowUp[];
    relatedNames: readonly string[];
    coAttendance: readonly { name: string; count: number }[];
    /** 互动条数范围；0 = 全部 */
    limit: number;
    /** 生成时间文本（由调用方注入以保证确定性） */
    generatedAt: string;
    /** E-32：会面谈资与备忘列表（置顶于简报中） */
    topics?: readonly string[];
    /** E-36：重要日期与周年纪念日列表 */
    anniversaries?: readonly BriefingAnniversary[];
    /** 人情往来与账目记录 */
    exchanges?: readonly BriefingExchange[];
    /** 共同组织背景（同单位/同学校同窗） */
    commonOrgs?: readonly BriefingCommonOrg[];
    /** 可选排除的章节 ID 集合 */
    excludedSections?: readonly string[];
}

const SOURCE_LABELS: Record<string, string> = {
    manual: "手动记录",
    diary: "笔记捕获",
    api: "外部联动",
};

/** Markdown 行内转义：防止用户文本（姓名/备注）破坏文档结构 */

export function buildBriefingMarkdown(input: BriefingExportInput): string {
    const {
        person,
        timeline,
        followUps,
        relatedNames,
        coAttendance,
        limit,
        generatedAt,
        topics,
        anniversaries,
        exchanges,
        commonOrgs,
        excludedSections = [],
    } = input;
    const isExcluded = (sectionId: string) => excludedSections.includes(sectionId);
    const lines: string[] = [];
    lines.push(`# 会面简报：${escapeMarkdown(person.name)}`);
    lines.push("");
    lines.push(`- 生成时间：${escapeMarkdown(generatedAt)}`);

    // E-32 会面谈资与备忘：会前置顶提醒
    const validTopics = (topics ?? []).filter((topic) => Boolean(topic && topic.trim()));
    if (!isExcluded("topics") && validTopics.length > 0) {
        lines.push("");
        lines.push(`## 会面谈资与备忘（${validTopics.length} 条）`);
        for (const topic of validTopics) {
            lines.push(`- 📌 ${escapeMarkdown(topic.trim())}`);
        }
    }

    // 基本资料
    if (!isExcluded("profile")) {
        const profile: string[] = [];
        if (person.group) profile.push(`- 分组：${escapeMarkdown(person.group)}`);
        if (person.phone) profile.push(`- 电话：${escapeMarkdown(person.phone)}`);
        if (person.email) profile.push(`- 邮箱：${escapeMarkdown(person.email)}`);
        if (person.wechat) profile.push(`- 微信：${escapeMarkdown(person.wechat)}`);
        if (person.tags.length > 0) profile.push(`- 标签：${person.tags.map(escapeMarkdown).join("、")}`);
        if (person.profile) {
            profile.push(`- 工作单位：${escapeMarkdown(profileText(person.profile, "work"))}`);
            profile.push(`- 学校：${escapeMarkdown(profileText(person.profile, "education"))}`);
            profile.push(`- 与我的关系：${escapeMarkdown(profileText(person.profile, "relationship"))}`);
            profile.push("- 来源：组织成员分类与当前本人参照下的人工称谓；历史任职另见组织归属");
        }
        if (profile.length > 0) {
            lines.push("");
            lines.push("## 基本资料");
            lines.push(...profile);
        }
    }

    // 共同组织背景
    const validCommonOrgs = (commonOrgs ?? []).filter((org) => Boolean(org.orgName?.trim()));
    if (!isExcluded("commonOrgs") && validCommonOrgs.length > 0) {
        lines.push("");
        lines.push(`## 共同组织背景（${validCommonOrgs.length} 个组织）`);
        for (const org of validCommonOrgs) {
            const peerLabels = (org.peers ?? []).map((p) => {
                if (typeof p === "string") return p;
                const periodTag = p.samePeriod ? "（同期经历）" : "";
                const overlap = p.overlapText && p.overlapText !== "—" ? ` [${p.overlapText}]` : "";
                return `${p.name}${periodTag}${overlap}`;
            });
            const peerStr = peerLabels.length > 0 ? ` · 同伴: ${peerLabels.join("、")}` : "";
            lines.push(`- 🏢 **${escapeMarkdown(org.orgName)}**${peerStr}`);
        }
    }

    // 上次互动与最近互动（范围由 limit 决定）
    const listed = timeline.slice(0, limit > 0 ? limit : timeline.length);
    if (!isExcluded("timeline") && listed.length > 0) {
        lines.push("");
        lines.push(`## 最近互动（${listed.length} 条${limit > 0 && timeline.length > listed.length ? `，共 ${timeline.length} 条` : ""}）`);
        for (const item of listed) {
            const detail = item.note?.trim() || "互动记录";
            const group = item.groupSize > 1 ? ` · ${item.groupSize} 人同场` : "";
            const source = SOURCE_LABELS[item.source] ?? item.source;
            lines.push(`- ${item.localDate} — ${escapeMarkdown(detail)}（${source}${group}）`);
        }
    }

    // 未完成跟进
    if (!isExcluded("followUps") && followUps.length > 0) {
        lines.push("");
        lines.push(`## 未完成跟进（${followUps.length} 条）`);
        for (const item of followUps) {
            lines.push(`- ${item.dueDate} — ${escapeMarkdown(item.title || "保持联系")}`);
        }
    }

    // 重要日期与周年纪念日
    if (!isExcluded("anniversaries")) {
        const birthday = nextBirthday(person.birthday, person.isLunar);
        const validAnnivs = (anniversaries ?? []).filter((a) => Boolean(a.title?.trim()));
        if (birthday || validAnnivs.length > 0) {
            lines.push("");
            lines.push("## 重要日期与纪念日");
            if (birthday) {
                const lunar = person.isLunar ? " · 农历" : "";
                lines.push(`- 🎂 生日：${formatBirthdayDisplay(person.birthday, person.isLunar)}${lunar}；下次为 ${birthday.date.toLocaleDateString("zh-CN")}（${birthday.daysUntil === 0 ? "今天" : `${birthday.daysUntil} 天后`}）`);
            }
            for (const a of validAnnivs) {
                const lunarTag = a.isLunar ? "（农历）" : "";
                const daysTag = a.daysUntil !== undefined ? (a.daysUntil === 0 ? " · 今天" : ` · ${a.daysUntil} 天后`) : "";
                const yearsTag = a.yearsCount !== undefined ? `（第 ${a.yearsCount} 周年）` : "";
                lines.push(`- 🌟 ${escapeMarkdown(a.title)}：${a.date}${lunarTag}${yearsTag}${daysTag}`);
            }
        }
    }

    // 人情往来账本备忘
    const validExchanges = (exchanges ?? []).filter((ex) => Boolean(ex.description?.trim()));
    if (!isExcluded("exchanges") && validExchanges.length > 0) {
        lines.push("");
        lines.push(`## 人情往来备忘（${validExchanges.length} 笔）`);
        for (const ex of validExchanges) {
            const dirLabel = ex.direction === "receivable" ? "对方欠我" : "我欠对方";
            const amtStr = ex.amount !== undefined ? ` ¥${ex.amount} ${ex.currency || "CNY"}` : "";
            const statusLabel = ex.status === "settled" ? "已结清" : ex.status === "cancelled" ? "已作废" : "待处理";
            lines.push(`- ${ex.occurredOn} · [${dirLabel}] ${escapeMarkdown(ex.description)}${amtStr}（${statusLabel}）`);
        }
    }

    // 相关人物
    if (!isExcluded("related")) {
        const names = relatedNames.filter(Boolean);
        if (names.length > 0) {
            lines.push("");
            lines.push("## 相关人物");
            for (const name of names) lines.push(`- ${escapeMarkdown(name)}`);
        }
    }

    // 共同出席
    if (!isExcluded("coAttendance")) {
        const attendance = coAttendance.filter((item) => item.name);
        if (attendance.length > 0) {
            lines.push("");
            lines.push("## 共同出席");
            for (const item of attendance) lines.push(`- 与 ${escapeMarkdown(item.name)} 同场 ${item.count} 次`);
        }
    }

    lines.push("");
    lines.push("---");
    lines.push("来源：小驴人脉插件导出 · 仅含本地记录的事实，交往次数不代表关系亲疏。");
    return lines.join("\n");
}

/**
 * 会面简报下载文件名生成（K-11 / CODE-02.14）：对人物姓名做跨平台安全清洗与防截断保护。
 */
export function buildBriefingFilename(personName: string, stamp: string): string {
    const safeName = sanitizeFileName(personName, "联系人", 50);
    const safeStamp = sanitizeFileName(stamp, new Date().toISOString().slice(0, 10), 20);
    return `小驴人脉_简报_${safeName}_${safeStamp}.md`;
}
