<script lang="ts">
    /** 联系人卡片（列表默认视图） */
    import type { ContactSummary } from "../../domain/person";
    import { formatBirthdayDisplay, nextBirthday } from "../../domain/occasions";
    import { formatRelativeInteraction } from "../../domain/format";
    import { ExternalLink, Phone, MessageCircle, Mail, Clock3 } from "@lucide/svelte";
    import PersonProfileSummary from "./PersonProfileSummary.svelte";

    let {
        person,
        onOpen,
        selected = false,
        active = false,
        onToggleSelected,
        onOpenPersonDoc,
        recent,
        recentUnknown = false,
        orgLine = "",
    }: {
        person: ContactSummary;
        onOpen: (person: ContactSummary) => void;
        selected?: boolean;
        active?: boolean;
        onToggleSelected?: (selected: boolean) => void;
        onOpenPersonDoc?: (docId: string) => void;
        recent?: { occurredAt: number; localDate: string };
        recentUnknown?: boolean;
        /** B12：单位显示串（组织名 · 部门，来自成员索引投影） */
        orgLine?: string;
    } = $props();

    function telHref(phone: string): string {
        return `tel:${phone}`;
    }

    function mailHref(email: string): string {
        return `mailto:${email}`;
    }
    const birthday = $derived(nextBirthday(person.birthday, person.isLunar));
    const recentLabel = $derived.by(() => {
        if (recentUnknown) return "最近互动待核实";
        if (!recent) return "暂无互动";
        const today = new Date();
        const day = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const then = new Date(`${recent.localDate}T00:00:00`).getTime();
        return formatRelativeInteraction(Math.round((day - then) / 86400000));
    });
</script>

<!-- 卡片保留鼠标快捷打开；tabindex 仅用于关闭详情后恢复焦点，键盘入口是独立详情按钮。 -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article
    class="lvct-person-card"
    class:lvct-person-card--active={active}
    tabindex="-1"
    aria-label={`${person.name}，联系人`}
    data-person-item-id={person.itemId}
    onclick={(event) => {
        if ((event.target as HTMLElement)?.closest("input, button, a, label")) return;
        event.currentTarget.focus({ preventScroll: true });
        onOpen(person);
    }}
>
    <div class="lvct-person-card__top">
    {#if onToggleSelected}
        <label class="lvct-person-card__select-hit-area" onclick={(event) => event.stopPropagation()}>
            <input
                class="lvct-person-card__select"
                type="checkbox"
                aria-label={`选择 ${person.name}`}
                checked={selected}
                onclick={(event) => event.stopPropagation()}
                onchange={(event) => onToggleSelected?.((event.currentTarget as HTMLInputElement).checked)}
            />
        </label>
    {/if}
    <button type="button" class="lvct-person-card__details" aria-label={`查看 ${person.name} 的详情`} onclick={(event) => { event.stopPropagation(); onOpen(person); }}>
        <span class="lvct-person-card__avatar" data-group={person.group || "未分组"}>
            {person.name.slice(0, 1)}
        </span>
        <span class="lvct-person-card__main">
            <span class="lvct-person-card__name" title={person.name}>
                {person.name}
                {#if person.isSelf}<span class="lvct-chip lvct-bucket--today">本人</span>{/if}
            </span>
            <span class="lvct-person-card__sub">
                {#if birthday}{formatBirthdayDisplay(person.birthday, person.isLunar)} · {birthday.daysUntil === 0 ? "今天" : `${birthday.daysUntil} 天后`}{:else}生日未填写{/if}
            </span>
        </span>
    </button>
    {#if onOpenPersonDoc}<button type="button" class="lvct-person-card__open-doc" title={`打开 ${person.name} 的文档`} aria-label={`打开 ${person.name} 的文档`} onclick={(event) => { event.stopPropagation(); onOpenPersonDoc(person.docId); }}><ExternalLink size={16}/></button>{/if}
    </div>
    {#if person.profile}<PersonProfileSummary profile={person.profile} compact hideEmpty />
    {:else if orgLine}
        <div class="lvct-person-card__org" aria-label="单位">{orgLine}</div>
    {/if}
    <div class="lvct-person-card__meta">
        {#if person.phone}<div><span aria-hidden="true"><Phone size={13}/></span><a class="lvct-person-card__meta-value" href={telHref(person.phone)} onclick={(event) => event.stopPropagation()}>{person.phone}</a></div>{/if}
        {#if person.wechat}<div><span aria-hidden="true"><MessageCircle size={13}/></span><span class="lvct-person-card__meta-value">{person.wechat}</span></div>{/if}
        {#if person.email}<div><span aria-hidden="true"><Mail size={13}/></span><a class="lvct-person-card__meta-value" href={mailHref(person.email)} onclick={(event) => event.stopPropagation()}>{person.email}</a></div>{/if}
        <div><span aria-hidden="true"><Clock3 size={13}/></span><span class="lvct-person-card__meta-value">{recentLabel}</span></div>
    </div>
    {#if person.group || person.tags.length > 0}
        <div class="lvct-person-card__tags">
            {#if person.group}<span class="lvct-chip lvct-chip--group">{person.group}</span>{/if}
            {#each person.tags as tag (tag)}<span class="lvct-chip"># {tag}</span>{/each}
        </div>
    {/if}
</article>
