/**
 * 人物文档档案条：打开联系人的人物文档时，在标题下方注入一条轻量档案
 * （电话/微信/生日/分组/标签 + 编辑资料按钮）。
 * 判定走名册缓存（rootID 是否为联系人文档），非联系人文档不注入、零 DOM 干扰。
 * 本模块是 protyle DOM 与组件层之间的 glue，位于 panels/（视图层之上）。
 */
import { getRoster } from "../services/roster";
import { svelteDialog } from "../libs/dialog";
import PersonEditDialog from "../components/people/PersonEditDialog.svelte";
import { escapeHtml } from "../shared/dom";
import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../domain/model";
import type { ContactSummary } from "../domain/person";

const STRIP_CLASS = "lvct-doc-strip";

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
    protyle.element.querySelector(`.${STRIP_CLASS}`)?.remove();
    if (!rootId || !context.settings) return;
    try {
        const roster = await getRoster(context.settings);
        const person = roster.find((item) => item.docId === rootId);
        if (!person) return;
        const strip = buildStrip(context, protyle, person);
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

function buildStrip(context: PanelContext, protyle: ProtyleLike, person: ContactSummary): HTMLElement {
    const strip = document.createElement("div");
    strip.className = `${STRIP_CLASS} lvct-strip`;
    strip.dataset.personDocId = person.docId;

    const chips = document.createElement("div");
    chips.className = "lvct-strip__chips";
    const chipData: string[] = [];
    if (person.group) chipData.push(escapeHtml(person.group));
    if (person.phone) chipData.push(`📞 ${escapeHtml(person.phone)}`);
    if (person.wechat) chipData.push(`💬 ${escapeHtml(person.wechat)}`);
    if (person.email) chipData.push(`✉️ ${escapeHtml(person.email)}`);
    if (person.birthday) chipData.push(`🎂 ${escapeHtml(person.birthday)}${person.isLunar ? "（农历）" : ""}`);
    for (const tag of person.tags) chipData.push(escapeHtml(`#${tag}`));
    if (chipData.length === 0) {
        const empty = document.createElement("span");
        empty.className = "ft__smaller ft__on-surface";
        empty.textContent = "联系人档案（未填写联系资料，点右侧编辑）";
        chips.appendChild(empty);
    }
    for (const chip of chipData) {
        const span = document.createElement("span");
        span.className = "lvct-chip";
        span.textContent = chip;
        chips.appendChild(span);
    }

    const actions = document.createElement("div");
    actions.className = "lvct-strip__actions";
    const edit = document.createElement("button");
    edit.className = "b3-button b3-button--small b3-button--text";
    edit.textContent = "编辑资料";
    edit.addEventListener("click", () => openEditDialog(context, protyle, person));
    actions.appendChild(edit);

    strip.appendChild(chips);
    strip.appendChild(actions);
    return strip;
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
            onClose: () => {},
        },
    });
}
