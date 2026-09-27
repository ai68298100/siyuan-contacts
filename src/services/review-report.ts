/**
 * 交往回顾报表服务（F12）：名册（人名解析）+ 互动事件 → 区间报表。
 * 只读投影，无新存储；区间由组件选择（本月/最近 30/90 天/自定义起止）。
 */
import type { Plugin } from "siyuan";
import { buildReviewReport } from "../domain/review-report";
import type { ReviewRange, ReviewReport } from "../domain/review-report";
import type { ContactsSettings } from "../domain/model";
import { loadInteractionStore } from "../data/interactions";
import { getRoster } from "./roster";

export async function buildReview(
    plugin: Plugin,
    settings: ContactsSettings,
    range: ReviewRange,
): Promise<ReviewReport> {
    const [roster, store] = await Promise.all([getRoster(settings), loadInteractionStore(plugin)]);
    return buildReviewReport({ events: store.events, roster, range });
}
