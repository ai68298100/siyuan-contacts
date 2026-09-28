/**
 * B07 跟进 → 人物文档原生任务块：任务行序列化/解析与同步计划的纯函数层。
 * 端点行为经隔离内核实证（scripts/spike/task-item-spike.mjs，12/12；契约 docs/DATA-CONTRACT.md §3.1）。
 * 关联键 custom-lvct-followup="<id>" 挂任务块 IAL；文档为事实源，对账以文档为准。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

export interface FollowUpTaskPlan {
    /** insert = 新建任务块；update = 更新块 markdown；done = 打勾标记；delete = 移除任务块 */
    action: "insert" | "update" | "done" | "delete";
    /** update/done/delete 的目标块 ID */
    blockId?: string;
    /** insert/update 的任务行 markdown（不含换行） */
    markdown?: string;
    followUpId: string;
}

export interface DocTaskBlock {
    blockId: string;
    followUpId: string;
    /** 块原始 markdown（如 `- [X] 回电 📅2026-10-01`） */
    markdown: string;
}

const MARKER_RE = /^- \[([ xX-])\] /;
const DATE_MARK_RE = /📅(\d{4}-\d{2}-\d{2})/;

/** 任务行序列化：取消的计划不产出任务行（由 plan 的 delete 表达） */
export function buildTaskMarkdown(title: string, dueDate: string, done: boolean): string {
    const safeTitle = title.trim() || "保持联系";
    const titleText = safeTitle.split(/\r?\n/).join(" ");
    return `- [${done ? "X" : " "}] ${titleText} 📅${dueDate}`;
}

/** 任务行解析：done 取自标记（大写 X 为完成）；标题 = 去标记去日期后的剩余文本 */
export function parseTaskMarkdown(markdown: string): { done: boolean; title: string; dueDate: string | null } {
    const marker = markdown.match(MARKER_RE);
    const rest = marker ? markdown.slice(marker[0].length) : markdown;
    const date = rest.match(DATE_MARK_RE);
    const title = (date ? rest.replace(DATE_MARK_RE, "") : rest).trim();
    return {
        done: marker?.[1] === "X" || marker?.[1] === "x",
        title,
        dueDate: date ? date[1] : null,
    };
}

/**
 * 写侧同步计划：open 跟进 → 任务块存在则比对（标题/日期/勾选不一致即 update）、
 * 不存在即 insert；done → 已有块打勾（无块则忽略：历史事项不回填文档）；
 * cancelled → 已有块删除（无块忽略）。
 * 仅操作传入 blocks 里带自己关联键的块——用户手工任务不在 blocks 中，天然不被触碰。
 */
export function planTaskSync(
    items: readonly { id: string; title: string; dueDate: string; status: "open" | "done" | "cancelled" }[],
    blocks: readonly DocTaskBlock[],
): FollowUpTaskPlan[] {
    const plans: FollowUpTaskPlan[] = [];
    const byId = new Map(blocks.map((block) => [block.followUpId, block]));
    const touched = new Set<string>();
    for (const item of items) {
        const block = byId.get(item.id);
        if (item.status === "cancelled") {
            if (block) {
                plans.push({ action: "delete", blockId: block.blockId, followUpId: item.id });
                touched.add(item.id);
            }
            continue;
        }
        if (item.status === "done") {
            if (block && !parseTaskMarkdown(block.markdown).done) {
                plans.push({ action: "done", blockId: block.blockId, followUpId: item.id });
            }
            touched.add(item.id);
            continue;
        }
        const expected = buildTaskMarkdown(item.title, item.dueDate, false);
        if (!block) {
            plans.push({ action: "insert", markdown: expected, followUpId: item.id });
        } else if (normalizeLine(block.markdown) !== normalizeLine(expected)) {
            plans.push({ action: "update", blockId: block.blockId, markdown: expected, followUpId: item.id });
        }
        touched.add(item.id);
    }
    /* 文档里有关联键但插件库已无此跟进（导入合并/历史清理）：不动文档块（文档为事实源），交由读对账收敛 */
    void touched;
    return plans;
}

function normalizeLine(line: string): string {
    return line.replace(/\s+/g, " ").trim();
}

/** 读侧对账决策（文档为准）：返回需要改插件库状态的跟进 id 列表 */
export function reconcileDecisions(
    items: readonly { id: string; status: "open" | "done" | "cancelled" }[],
    blocks: readonly DocTaskBlock[],
): { toDone: string[]; toOpen: string[] } {
    const toDone: string[] = [];
    const toOpen: string[] = [];
    const byId = new Map(blocks.map((block) => [block.followUpId, block]));
    for (const item of items) {
        if (item.status === "cancelled") continue; /* 取消的记录不因文档复活 */
        const block = byId.get(item.id);
        if (!block) continue;
        const done = parseTaskMarkdown(block.markdown).done;
        if (done && item.status === "open") toDone.push(item.id);
        if (!done && item.status === "done") toOpen.push(item.id);
    }
    return { toDone, toOpen };
}
