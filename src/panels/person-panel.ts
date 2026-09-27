/**
 * 人物文档档案条：打开联系人的人物文档时，在标题下方注入一条轻量档案
 * （电话/微信/生日/分组/标签 + 编辑资料按钮）。
 * 判定走名册缓存（rootID 是否为联系人文档），非联系人文档不注入、零 DOM 干扰。
 * 本模块是 protyle DOM 与组件层之间的 glue，位于 panels/（视图层之上）。
 */
import { getRoster } from "../services/roster";
import { loadInteractionStore } from "../data/interactions";
import { lastInteractionByPerson } from "../domain/interactions";
import { nextBirthday } from "../domain/occasions";
import { svelteDialog } from "../libs/dialog";
import PersonEditDialog from "../components/people/PersonEditDialog.svelte";
import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../domain/model";
import type { ContactSummary } from "../domain/person";

const STRIP_CLASS = "lvct-doc-strip";
const stripRequests = new WeakMap<HTMLElement, number>();

export interface PanelContext {
    plugin: Plugin;
    settings: ContactsSettings | null;
}

interface ProtyleLike {
    element: HTMLElement;
    block?: { rootID?: string };
}

type ProtyleEvent = { detail?: { protyle?: ProtyleLike } };

/** protyle 事件入口（loaded-protyle-static/dynamic、switch-protyle） */
export function handleProtyleEvent(context: PanelContext, event: ProtyleEvent): void {
    const protyle = event.detail?.protyle;
    if (!protyle?.element || !context.settings) return;
    const rootId = protyle.block?.rootID ?? "";
    void updateStrip(context, protyle, rootId);
}

async function updateStrip(context: PanelContext, protyle: ProtyleLike, rootId: string): Promise<void> {
    const request = (stripRequests.get(protyle.element) ?? 0) + 1;
    stripRequests.set(protyle.element, request);
    protyle.element.querySelector(`.${STRIP_CLASS}`)?.remove();
    if (!rootId || !context.settings) return;
    try {
        const roster = await getRoster(context.settings);
        const person = roster.find((item) => item.docId === rootId);
        if (!person) return;
        const interactionStore = await loadInteractionStore(context.plugin);
        if (stripRequests.get(protyle.element) !== request || protyle.block?.rootID !== rootId || !protyle.element.isConnected) return;
        const lastInteraction = lastInteractionByPerson(interactionStore, [person]).get(person.docId);
        const birthday = person.birthday ? nextBirthday(person.birthday, person.isLunar) : undefined;
        const strip = buildStrip(context, protyle, person, birthday?.daysUntil, lastInteraction?.lastDaysAgo);
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

function buildStrip(
    context: PanelContext,
    protyle: ProtyleLike,
    person: ContactSummary,
    birthdayDaysUntil?: number,
    lastDaysAgo?: number,
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
        badges.appendChild(makeBadge(birthdayDaysUntil === 0 ? "生日今天" : `生日 ${birthdayDaysUntil} 天后`, "lvct-strip__badge--birthday"));
    }
    badges.appendChild(
        makeBadge(
            lastDaysAgo === undefined ? "尚未互动" : lastDaysAgo === 0 ? "今天互动" : `最近互动 ${lastDaysAgo} 天前`,
            lastDaysAgo === undefined ? "lvct-strip__badge--muted" : "lvct-strip__badge--activity",
        ),
    );
    identity.appendChild(badges);

    const chips = document.createElement("div");
    chips.className = "lvct-strip__chips";
    const chipData: string[] = [];
    if (person.phone) chipData.push(`📞 ${person.phone}`);
    if (person.wechat) chipData.push(`💬 ${person.wechat}`);
    if (person.email) chipData.push(`✉️ ${person.email}`);
    if (person.birthday) chipData.push(`🎂 ${person.birthday}${person.isLunar ? "（农历）" : ""}`);
    for (const tag of person.tags) chipData.push(`#${tag}`);
    if (chipData.length === 0) {
        const empty = document.createElement("span");
        empty.className = "ft__smaller ft__on-surface";
        empty.textContent = "未填写联系资料，可点右侧编辑";
        chips.appendChild(empty);
    }
    for (const chip of chipData) {
        const span = document.createElement("span");
        span.className = "lvct-chip";
        span.textContent = chip;
        chips.appendChild(span);
    }
    main.appendChild(identity);
    main.appendChild(chips);

    // 二期会前简报的稳定插槽：先提供可折叠的占位，不伪造尚未落库的数据。
    const briefing = document.createElement("details");
    briefing.className = "lvct-strip__briefing";
    briefing.dataset.slot = "briefing";
    const briefingSummary = document.createElement("summary");
    briefingSummary.textContent = "会前简报（预留）";
    const briefingHint = document.createElement("span");
    briefingHint.className = "ft__smaller ft__on-surface";
    briefingHint.textContent = "后续可在这里汇总最近互动、共同联系人和待办事项";
    briefing.append(briefingSummary, briefingHint);
    main.appendChild(briefing);

    const actions = document.createElement("div");
    actions.className = "lvct-strip__actions";
    const edit = document.createElement("button");
    edit.className = "b3-button b3-button--small b3-button--text";
    edit.textContent = "编辑资料";
    edit.addEventListener("click", () => openEditDialog(context, protyle, person));
    actions.appendChild(edit);

    const open = document.createElement("button");
    open.className = "b3-button b3-button--small b3-button--outline";
    open.textContent = "打开人脉";
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
            person,
            onSaved: () => {
                void updateStrip(context, protyle, person.docId);
            },
        },
    });
}
