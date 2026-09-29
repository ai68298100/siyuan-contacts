/**
 * 人物文档档案条：打开联系人的人物文档时，在标题下方注入一条轻量档案
 * （电话/微信/生日/分组/标签 + 编辑资料按钮）。
 * 判定走名册缓存（rootID 是否为联系人文档），非联系人文档不注入、零 DOM 干扰。
 * 本模块是 protyle DOM 与组件层之间的 glue，位于 panels/（视图层之上）。
 */
import { getRoster, invalidateRoster } from "../services/roster";
import { loadInteractionStore } from "../data/interactions";
import type { InteractionEvent } from "../domain/interactions";
import { loadFollowUpStore } from "../data/followups";
import { lastInteractionByPerson } from "../domain/interactions";
import { buildMeetingBriefing } from "../domain/briefing";
import type { MeetingBriefingItem } from "../domain/briefing";
import { getOrgDisplayForDoc } from "../services/org";
import { nextBirthday } from "../domain/occasions";
import { svelteDialog } from "../libs/dialog";
import { subscribeDataChanged } from "../libs/data-events";
import PersonEditDialog from "../components/people/PersonEditDialog.svelte";
import { translateText } from "../domain/translation";
import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../domain/model";
import type { ContactSummary } from "../domain/person";

const STRIP_CLASS = "lvct-doc-strip";
const stripRequests = new WeakMap<HTMLElement, number>();
/** FUNC-01.7-a：已注入档案条的活跃文档登记——数据变化时原地重渲染（不整页刷新） */
const activeStrips = new Map<HTMLElement, { context: PanelContext; protyle: ProtyleLike; rootId: string }>();
let dataSubscription: (() => void) | null = null;

export interface PanelContext {
    plugin: Plugin;
    settings: ContactsSettings | null;
    i18n?: Record<string, string>;
}

interface ProtyleLike {
    element: HTMLElement;
    block?: { rootID?: string };
}

type ProtyleEvent = { detail?: { protyle?: ProtyleLike } };

/** protyle 事件入口（loaded-protyle-static/dynamic、switch-protyle） */
export function handleProtyleEvent(context: PanelContext, event: ProtyleEvent): void {
    ensureDataSubscription();
    const protyle = event.detail?.protyle;
    if (!protyle?.element || !context.settings) return;
    const rootId = protyle.block?.rootID ?? "";
    void updateStrip(context, protyle, rootId);
}

/** 数据变化（含跨窗口）：名册缓存立即失效，活跃档案条逐个重渲染（乱序由 stripRequests 代际挡） */
function ensureDataSubscription(): void {
    if (dataSubscription) return;
    dataSubscription = subscribeDataChanged(() => {
        invalidateRoster();
        for (const [element, entry] of [...activeStrips]) {
            if (!element.isConnected) {
                activeStrips.delete(element);
                continue;
            }
            void updateStrip(entry.context, entry.protyle, entry.rootId);
        }
    });
}

async function updateStrip(context: PanelContext, protyle: ProtyleLike, rootId: string): Promise<void> {
    const request = (stripRequests.get(protyle.element) ?? 0) + 1;
    stripRequests.set(protyle.element, request);
    protyle.element.querySelector(`.${STRIP_CLASS}`)?.remove();
    if (!rootId || !context.settings) {
        activeStrips.delete(protyle.element);
        return;
    }
    try {
        const roster = await getRoster(context.settings);
        const person = roster.find((item) => item.docId === rootId);
        if (!person) {
            activeStrips.delete(protyle.element);
            return;
        }
        activeStrips.set(protyle.element, { context, protyle, rootId });
        const [interactionStore, followUpStore] = await Promise.all([
            loadInteractionStore(context.plugin),
            loadFollowUpStore(context.plugin),
        ]);
        if (stripRequests.get(protyle.element) !== request || protyle.block?.rootID !== rootId || !protyle.element.isConnected) return;
        const lastInteraction = lastInteractionByPerson(interactionStore, [person]).get(person.docId);
        const birthday = person.birthday ? nextBirthday(person.birthday, person.isLunar) : undefined;
        /* B12：简报追加「单位」组织归属行（失败降级为无该行） */
        const orgLine = await getOrgDisplayForDoc(person.docId).catch(() => "");
        const briefing = buildMeetingBriefing(
            person,
            roster,
            interactionStore.events,
            orgLine ? [{ label: "单位", value: orgLine }] : [],
        );
        const openFollowUps = followUpStore.items.filter(
            (item) => item.personDocId === person.docId && item.status === "open",
        ).length;
        const latestEvent = interactionStore.events.reduce<InteractionEvent | null>(
            (acc, event) => (event.personDocId === person.docId && (!acc || event.occurredAt > acc.occurredAt) ? event : acc),
            null,
        );
        const strip = buildStrip(context, protyle, person, briefing, birthday?.daysUntil, lastInteraction?.lastDaysAgo, {
            openFollowUps,
            latestNote: latestEvent?.note,
        });
        const title = protyle.element.querySelector(".protyle-title");
        if (title) {
            title.insertAdjacentElement("afterend", strip);
        } else {
            protyle.element.prepend(strip);
        }
    } catch (error) {
        console.warn("[lvct] 档案条渲染失败", error);
    }
}

/** 档案条文案取值（i18n 可选，缺失回退中文） */
function t(context: PanelContext, key: string, fallback: string, values?: Record<string, string | number>): string {
    return translateText(context.i18n, key, fallback, values);
}
/** 档案条 chips 最多直接展示的枚数，超出折叠为 +N（悬停可见全量） */
const STRIP_CHIPS_MAX = 6;

function buildStrip(
    context: PanelContext,
    protyle: ProtyleLike,
    person: ContactSummary,
    briefingItems: readonly MeetingBriefingItem[],
    birthdayDaysUntil?: number,
    lastDaysAgo?: number,
    extras: { openFollowUps?: number; latestNote?: string } = {},
): HTMLElement {
    const strip = document.createElement("div");
    strip.className = `${STRIP_CLASS} lvct-strip`;
    strip.dataset.personDocId = person.docId;

    const avatar = document.createElement("span");
    avatar.className = "lvct-strip__avatar";
    avatar.textContent = person.name.slice(0, 1) || "人";

    const main = document.createElement("div");
    main.className = "lvct-strip__main";
    const identity = document.createElement("div");
    identity.className = "lvct-strip__identity";
    const name = document.createElement("b");
    name.textContent = person.name;
    identity.appendChild(name);

    const badges = document.createElement("div");
    badges.className = "lvct-strip__badges";
    if (person.group) badges.appendChild(makeBadge(person.group, "lvct-strip__badge--group"));
    if (birthdayDaysUntil !== undefined) {
        badges.appendChild(makeBadge(birthdayDaysUntil === 0 ? t(context, "stripBirthdayToday", "生日今天") : t(context, "stripBirthdayIn", "生日 {n} 天后", { n: birthdayDaysUntil }), "lvct-strip__badge--birthday"));
    }
    badges.appendChild(
        makeBadge(
            lastDaysAgo === undefined ? t(context, "stripNever", "尚未互动") : lastDaysAgo === 0 ? t(context, "stripToday", "今天互动") : t(context, "stripLastDays", "最近互动 {n} 天前", { n: lastDaysAgo }),
            lastDaysAgo === undefined ? "lvct-strip__badge--muted" : "lvct-strip__badge--activity",
        ),
    );
    // B04：计划与关系计数上条，一眼看到「欠着几件事、连着几个人」
    if (extras.openFollowUps) {
        badges.appendChild(makeBadge(t(context, "stripFollowUpsOpen", "待跟进 {n}", { n: extras.openFollowUps }), "lvct-strip__badge--activity"));
    }
    if (person.relatedItemIds.length > 0) {
        badges.appendChild(makeBadge(t(context, "stripRelatedCount", "相关人 {n}", { n: person.relatedItemIds.length }), "lvct-strip__badge--muted"));
    }
    identity.appendChild(badges);

    const chips = document.createElement("div");
    chips.className = "lvct-strip__chips";
    const chipData: string[] = [];
    if (extras.latestNote) chipData.push(`🗒 ${extras.latestNote}`);
    if (person.phone) chipData.push(`📞 ${person.phone}`);
    if (person.wechat) chipData.push(`💬 ${person.wechat}`);
    if (person.email) chipData.push(`✉️ ${person.email}`);
    if (person.birthday) chipData.push(`🎂 ${person.birthday}${person.isLunar ? t(context, "stripLunarSuffix", "（农历）") : ""}`);
    for (const tag of person.tags) chipData.push(`#${tag}`);
    if (chipData.length === 0) {
        const empty = document.createElement("span");
        empty.className = "ft__smaller ft__on-surface";
        empty.textContent = t(context, "stripEmptyContact", "未填写联系资料，可点右侧编辑");
        chips.appendChild(empty);
    }
    // B04：chips 有上限，超出折叠为 +N（title 带全量），防止长标签撑爆档案条
    const visibleChips = chipData.slice(0, STRIP_CHIPS_MAX);
    for (const chip of visibleChips) {
        const span = document.createElement("span");
        span.className = "lvct-chip";
        span.textContent = chip;
        chips.appendChild(span);
    }
    if (chipData.length > visibleChips.length) {
        const more = document.createElement("span");
        more.className = "lvct-chip lvct-strip__chip-more";
        more.textContent = t(context, "stripChipsMore", "+{n}", { n: chipData.length - visibleChips.length });
        more.title = chipData.slice(visibleChips.length).join("、");
        chips.appendChild(more);
    }
    main.appendChild(identity);
    main.appendChild(chips);

    const briefing = document.createElement("details");
    briefing.className = "lvct-strip__briefing";
    briefing.dataset.slot = "briefing";
    const briefingSummary = document.createElement("summary");
    briefingSummary.textContent = briefingItems.length > 0 ? t(context, "stripBriefingCount", "会前简报（{n}）", { n: briefingItems.length }) : t(context, "stripBriefingTitle", "会前简报");
    briefing.appendChild(briefingSummary);
    if (briefingItems.length === 0) {
        const empty = document.createElement("p");
        empty.className = "lvct-strip__briefing-empty ft__smaller ft__on-surface";
        empty.textContent = t(context, "stripBriefingEmpty", "暂无互动、关系或共同出席记录");
        briefing.appendChild(empty);
    } else {
        const list = document.createElement("dl");
        list.className = "lvct-strip__briefing-list";
        for (const item of briefingItems) {
            const row = document.createElement("div");
            const label = document.createElement("dt");
            label.textContent = item.label;
            const value = document.createElement("dd");
            value.textContent = item.value;
            row.append(label, value);
            list.appendChild(row);
        }
        briefing.appendChild(list);
    }
    main.appendChild(briefing);

    const actions = document.createElement("div");
    actions.className = "lvct-strip__actions";
    const edit = document.createElement("button");
    edit.className = "b3-button b3-button--small b3-button--text";
    edit.textContent = t(context, "stripEdit", "编辑资料");
    edit.addEventListener("click", () => openEditDialog(context, protyle, person));
    actions.appendChild(edit);

    const open = document.createElement("button");
    open.className = "b3-button b3-button--small b3-button--outline";
    open.textContent = t(context, "stripOpen", "打开人脉");
    open.addEventListener("click", () => {
        const workbench = (context.plugin as Plugin & { openWorkbench?: () => void }).openWorkbench;
        workbench?.call(context.plugin);
    });
    actions.appendChild(open);

    strip.appendChild(avatar);
    strip.appendChild(main);
    strip.appendChild(actions);
    return strip;
}

function makeBadge(text: string, className: string): HTMLSpanElement {
    const badge = document.createElement("span");
    badge.className = `lvct-strip__badge ${className}`;
    badge.textContent = text;
    return badge;
}

function openEditDialog(context: PanelContext, protyle: ProtyleLike, person: ContactSummary): void {
    if (!context.settings) return;
    svelteDialog({
        title: `编辑资料 · ${person.name}`,
        width: "620px",
        component: PersonEditDialog,
        props: {
            settings: context.settings,
            i18n: context.i18n,
            person,
            onSaved: () => {
                void updateStrip(context, protyle, person.docId);
            },
        },
    });
}
